"use client";

import dynamic from "next/dynamic";

const EditorShell = dynamic(() => import("@/components/editor-shell"), {
  loading: () => <p className="loading">正在准备本地编辑器...</p>,
  ssr: false,
});

export default function Home() {
  return <EditorShell />;
}
