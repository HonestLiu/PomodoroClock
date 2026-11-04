import { useRef, useState, type InputHTMLAttributes } from 'react';
import { Upload } from 'lucide-react';
import { useI18nStore } from '@/i18n';

/** App-drawn upload control; only the OS file dialog is native. */
export function FileInput({ onChange, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const zh = useI18nStore(s => s.lang) === 'zh';
  return <span className="app-file-control">
    <input {...props} ref={input} type="file" className="app-control-native" tabIndex={-1}
      onChange={e => { setName(Array.from(e.target.files ?? []).map(f => f.name).join(', ')); onChange?.(e); }} />
    <button type="button" className="app-file-trigger" disabled={props.disabled} aria-describedby={props['aria-describedby']}
      onClick={() => input.current?.click()}><Upload size={14} aria-hidden />{zh ? '上传图片' : 'Upload image'}</button>
    {name && <span className="app-file-name" title={name}>{name}</span>}
  </span>;
}
