// 统一错误类型：所有 command 返回 Result<T, AppError>，前端收到字符串消息。
//
// 安全约定：底层 sqlite/io/serde 的原始错误只写日志，不透传给前端
// （原实现会把 SQL 语句、文件路径等内部细节直接显示在 UI 上）。
// 文案保持中文短句，便于后续映射到 src/i18n 的 error.* key。

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库操作失败，请稍后重试")]
    Db(#[from] rusqlite::Error),
    #[error("数据格式错误")]
    Json(#[from] serde_json::Error),
    #[error("文件操作失败")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            AppError::Msg(m) => s.serialize_str(m),
            other => {
                // 内部细节仅记录到日志，返回前端的只有上面的友好文案。
                eprintln!("[AppError] {other:?}");
                s.serialize_str(&other.to_string())
            }
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
