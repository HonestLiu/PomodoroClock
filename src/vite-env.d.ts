/// <reference types="vite/client" />

/** PocketBase 云端地址（不写则回退到 src/lib/pb.ts 里的内置默认值） */
interface ImportMetaEnv {
  readonly VITE_PB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
