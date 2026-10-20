// Copyright 2020-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
  borrow::Cow,
  ffi::{c_char, CStr},
  panic::AssertUnwindSafe,
  ptr::NonNull,
};

use http::{
  header::{CONTENT_LENGTH, CONTENT_TYPE},
  Request, Response as HttpResponse, StatusCode, Version,
};
use objc2::{
  rc::Retained,
  runtime::{AnyClass, AnyObject, ClassBuilder, ProtocolObject},
  AllocAnyThread, ClassType, Message,
};
use objc2_foundation::{
  NSData, NSHTTPURLResponse, NSMutableDictionary, NSObject, NSObjectProtocol, NSString, NSURL,
  NSUUID,
};
use objc2_web_kit::{WKURLSchemeHandler, WKURLSchemeTask};

use crate::{wkwebview::WEBVIEW_STATE, RequestAsyncResponder, WryWebView};

// === FocusPomodoro 本地补丁（wry 0.57.0）====================================
// WKURLSchemeTask 的 didReceiveResponse/didReceiveData/didFinish 必须在主线程
// 调用。Tauri 的 ipc:// 与 tauri:// 协议响应都在 tokio worker（ipc 命令完成）
// 上调用 responder；后台线程同时同步跳主线程（getExceptionTypeFromMainRunLoop）
// 时会与主线程已在执行的同类跳转形成嵌套等待，WebKit 直接 abort（实测番茄钟运行
// 约 30 分钟后 SIGABRT，崩溃栈：tokio-rt-worker → -[WKURLSchemeTaskImpl
// didFinish] → callOnMainRunLoopAndWait → abort）。
// 修复：所有 did* 调用改为 dispatch_async 到主队列（异步、串行、保序），worker
// 线程不再同步等待主线程。升级 wry 后需重新核对本补丁（上游 dev 截至 2026-10
// 仍未修复）。
#[cfg(target_vendor = "apple")]
fn run_on_main_thread<F>(f: F)
where
  F: FnOnce() + 'static,
{
  // Retained<WKURLSchemeTask> 等对象非 Send，但为 +1 retain 的 'static 句柄；
  // 所有 WebKit 消息发送都在闭包内（主线程）发生——与 wry 自身
  // `unsafe impl Send for RequestAsyncResponder` 的前提一致。这里把非 Send 的
  // FnOnce 包进 Send 包装，dispatch 的目标只有主线程（单线程串行），
  // `SendOnce` 不会并发访问。
  struct SendOnce(Box<dyn FnOnce()>);
  unsafe impl Send for SendOnce {}

  let send_once = SendOnce(Box::new(f));
  // dispatch_async 到主队列：异步、串行、保序；worker 线程不再同步等待主线程。
  dispatch2::Queue::main().exec_async(move || {
    let SendOnce(f) = send_once;
    f();
  });
}

pub fn create(name: &str) -> &AnyClass {
  unsafe {
    // Include the address of WEBVIEW_STATE in the class name so that each dylib in the process
    // gets its own ObjC class with method pointers into its own code and data segments.
    let unique_id = std::ptr::addr_of!(WEBVIEW_STATE) as usize;
    let scheme_name = format!("{name}URLSchemeHandler_{unique_id:x}\0");
    let scheme_name = CStr::from_bytes_with_nul(scheme_name.as_bytes()).unwrap();
    let cls = ClassBuilder::new(scheme_name, NSObject::class());
    match cls {
      Some(mut cls) => {
        cls.add_ivar::<*mut c_char>(c"webview_id");
        cls.add_ivar::<usize>(c"protocol_index");
        cls.add_method(
          objc2::sel!(webView:startURLSchemeTask:),
          start_task as extern "C" fn(_, _, _, _),
        );
        cls.add_method(
          objc2::sel!(webView:stopURLSchemeTask:),
          stop_task as extern "C" fn(_, _, _, _),
        );
        cls.register()
      }
      None => AnyClass::get(scheme_name).expect("Failed to get the class definition"),
    }
  }
}

// Task handler for custom protocol
extern "C" fn start_task(
  this: &AnyObject,
  _sel: objc2::runtime::Sel,
  webview: &WryWebView,
  task: &ProtocolObject<dyn WKURLSchemeTask>,
) {
  #[cfg(feature = "tracing")]
  let span =
    tracing::info_span!(parent: None, "wry::custom_protocol::handle", uri = tracing::field::Empty)
      .entered();

  let task_key = task.hash(); // hash by task object address
  let task_uuid = webview.add_custom_task_key(task_key);

  let ivar = this.class().instance_variable(c"webview_id").unwrap();
  let webview_id = unsafe {
    let webview_id_ptr: *mut c_char = *ivar.load(this);
    CStr::from_ptr(webview_id_ptr)
      .to_str()
      .ok()
      .unwrap_or_default()
  };

  let ivar = this.class().instance_variable(c"protocol_index").unwrap();
  let protocol_index: usize = unsafe { *ivar.load(this) };

  let function = WEBVIEW_STATE
    .read()
    .unwrap()
    .get(webview_id)
    .and_then(|v| v.protocol_ptrs.get(protocol_index))
    .cloned();

  if let Some(function) = function {
    // Get url request
    let request = unsafe { task.request() };
    let url = request.URL().unwrap();

    let uri = url.absoluteString().unwrap().to_string();

    #[cfg(feature = "tracing")]
    span.record("uri", uri.clone());

    // Get request method (GET, POST, PUT etc...)
    let method = request.HTTPMethod().unwrap().to_string();

    // Prepare our HttpRequest
    let mut http_request = Request::builder().uri(uri).method(method.as_str());

    // Get body
    let mut sent_form_body = Vec::new();
    let body = request.HTTPBody();
    let body_stream = request.HTTPBodyStream();
    if let Some(body) = body {
      sent_form_body = body.to_vec();
    } else if let Some(body_stream) = body_stream {
      body_stream.open();

      let mut buf = [0u8; 128];
      while body_stream.hasBytesAvailable() {
        let count =
          unsafe { body_stream.read_maxLength(NonNull::new(buf.as_mut_ptr()).unwrap(), buf.len()) };
        sent_form_body.extend_from_slice(&buf[..count as usize]);
      }

      body_stream.close();
    }

    // Extract all headers fields
    let all_headers = request.allHTTPHeaderFields();

    // get all our headers values and inject them in our request
    if let Some(all_headers) = all_headers {
      for current_header in all_headers.allKeys().iter() {
        let header_value = all_headers.valueForKey(&current_header).unwrap();
        // inject the header into the request
        http_request = http_request.header(current_header.to_string(), header_value.to_string());
      }
    }

    // 补丁：404 路径同样必须在主线程完成 task（见文件顶部说明）
    let respond_with_404 =
      |task: Retained<ProtocolObject<dyn WKURLSchemeTask>>, url: Retained<NSURL>| {
        run_on_main_thread(move || {
          let urlresponse = NSHTTPURLResponse::alloc();
          let response = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(
            urlresponse,
            &url,
            StatusCode::NOT_FOUND.as_u16().try_into().unwrap(),
            Some(&NSString::from_str(
              format!("{:#?}", Version::HTTP_11).as_str(),
            )),
            None,
          )
          .unwrap();
          unsafe {
            let _ = objc2::exception::catch(AssertUnwindSafe(|| {
              task.didReceiveResponse(&response);
            }));
            // Finish
            let _ = objc2::exception::catch(AssertUnwindSafe(|| {
              task.didFinish();
            }));
          }
        });
      };

    fn check_webview_id_valid(webview_id: &str) -> crate::Result<()> {
      if !WEBVIEW_STATE.read().unwrap().contains_key(webview_id) {
        return Err(crate::Error::CustomProtocolTaskInvalid);
      }
      Ok(())
    }

    /// Task may not live longer than async custom protocol handler.
    ///
    /// There are roughly 2 ways to cause segfault:
    /// 1. Task has stopped. pointer of the task not valid anymore.
    /// 2. Task had stopped, but the pointer of the task has allocated to a new task.
    ///    Outdated custom handler may call to the new task instance and cause segfault.
    fn check_task_is_valid(
      webview: &WryWebView,
      task_key: usize,
      current_uuid: Retained<NSUUID>,
    ) -> crate::Result<()> {
      let latest_task_uuid = webview.get_custom_task_uuid(task_key);
      let Some(latest_uuid) = latest_task_uuid else {
        return Err(crate::Error::CustomProtocolTaskInvalid);
      };
      if latest_uuid != current_uuid {
        return Err(crate::Error::CustomProtocolTaskInvalid);
      }
      Ok(())
    }

    // send response
    match http_request.body(sent_form_body) {
      Ok(final_request) => {
        let webview = webview.retain();
        let task = task.retain();
        let responder: Box<dyn FnOnce(HttpResponse<Cow<'static, [u8]>>)> =
          Box::new(move |sent_response| {
            // 补丁：整个响应（校验 + didReceiveResponse/Data/didFinish）都在
            // 主线程串行执行，见文件顶部说明。
            run_on_main_thread(move || {
            // Consolidate checks before calling into `did*` methods.
            let validate = || -> crate::Result<()> {
              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid.clone())?;
              Ok(())
            };

            // Perform an upfront validation
            if let Err(_e) = validate() {
              #[cfg(feature = "tracing")]
              tracing::warn!("Task invalid before sending response: {:?}", _e);
              return; // If invalid, return early without calling task methods.
            }

            fn response(
              // FIXME: though we give it a static lifetime, it's not guaranteed to be valid.
              task: Retained<ProtocolObject<dyn WKURLSchemeTask>>,
              // FIXME: though we give it a static lifetime, it's not guaranteed to be valid.
              webview: Retained<WryWebView>,
              task_key: usize,
              task_uuid: Retained<NSUUID>,
              webview_id: &str,
              url: Retained<NSURL>,
              sent_response: HttpResponse<Cow<'_, [u8]>>,
            ) -> crate::Result<()> {
              // Validate
              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid.clone())?;

              let content_len = sent_response.body().len();
              // default: application/octet-stream, but should be provided by the client
              let wanted_mime = sent_response.headers().get(CONTENT_TYPE);
              // default to 200
              let wanted_status_code = sent_response.status().as_u16() as i32;
              // default to HTTP/1.1
              let wanted_version = format!("{:#?}", sent_response.version());

              let headers = NSMutableDictionary::new();
              if let Some(mime) = wanted_mime {
                headers.insert(
                  &*NSString::from_str(CONTENT_TYPE.as_str()),
                  &*NSString::from_str(mime.to_str().unwrap()),
                );
              }
              headers.insert(
                &*NSString::from_str(CONTENT_LENGTH.as_str()),
                &*NSString::from_str(&content_len.to_string()),
              );

              // add headers
              for (name, value) in sent_response.headers().iter() {
                if let Ok(value) = value.to_str() {
                  headers.insert(
                    &*NSString::from_str(name.as_str()),
                    &*NSString::from_str(value),
                  );
                }
              }

              let urlresponse = NSHTTPURLResponse::alloc();
              let response = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(
                urlresponse,
                &url,
                wanted_status_code.try_into().unwrap(),
                Some(&NSString::from_str(&wanted_version)),
                Some(&headers),
              )
              .unwrap();

              // Re-validate before calling didReceiveResponse
              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid.clone())?;

              // Use map_err to convert Option<Retained<Exception>> to crate::Error
              objc2::exception::catch(AssertUnwindSafe(|| unsafe {
                task.didReceiveResponse(&response);
              }))
              .map_err(|_e| crate::Error::CustomProtocolTaskInvalid)?;

              let data = match sent_response.into_body() {
                Cow::Owned(content) => NSData::from_vec(content),
                Cow::Borrowed(content) => NSData::with_bytes(content),
              };

              // Check validity again
              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid.clone())?;

              objc2::exception::catch(AssertUnwindSafe(|| unsafe {
                task.didReceiveData(&data);
              }))
              .map_err(|_e| crate::Error::CustomProtocolTaskInvalid)?;

              check_webview_id_valid(webview_id)?;
              check_task_is_valid(&webview, task_key, task_uuid)?;

              objc2::exception::catch(AssertUnwindSafe(|| unsafe {
                task.didFinish();
              }))
              .map_err(|_e| crate::Error::CustomProtocolTaskInvalid)?;

              if WEBVIEW_STATE.read().unwrap().contains_key(webview_id) {
                webview.remove_custom_task_key(task_key);
                Ok(())
              } else {
                Err(crate::Error::CustomProtocolTaskInvalid)
              }
            }

            #[cfg(feature = "tracing")]
            let _span = tracing::info_span!("wry::custom_protocol::call_handler").entered();

            if let Err(_e) = response(
              task,
              webview,
              task_key,
              task_uuid,
              webview_id,
              url,
              sent_response,
            ) {
              #[cfg(feature = "tracing")]
              tracing::error!("Error responding to task: {:?}", _e);
            }
            }); // run_on_main_thread
          });

        #[cfg(feature = "tracing")]
        let _span = tracing::info_span!("wry::custom_protocol::call_handler").entered();

        function(
          webview_id,
          final_request,
          RequestAsyncResponder { responder },
        );
      }
      Err(_) => respond_with_404(task.retain(), url.retain()),
    };
  } else {
    #[cfg(feature = "tracing")]
    tracing::warn!(
      "Either WebView or WebContext instance is dropped! This handler shouldn't be called."
    );
  };
}

extern "C" fn stop_task(
  _this: &ProtocolObject<dyn WKURLSchemeHandler>,
  _sel: objc2::runtime::Sel,
  webview: &WryWebView,
  task: &ProtocolObject<dyn WKURLSchemeTask>,
) {
  webview.remove_custom_task_key(task.hash());
}
