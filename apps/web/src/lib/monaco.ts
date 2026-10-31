// Local Monaco (no CDN) so diffs work offline. Only syntax highlighting is loaded — no language services.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/edcore.main";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution";
import "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() };

monaco.languages.register({ id: "json" });

monaco.editor.defineTheme("codezero", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6F8693", fontStyle: "italic" },
    { token: "keyword", foreground: "40E0D0" },
    { token: "string", foreground: "8BFFB0" },
    { token: "number", foreground: "FFCB6B" },
    { token: "type", foreground: "7FD7FF" },
    { token: "identifier", foreground: "EDF7F5" },
  ],
  colors: {
    "editor.background": "#08131B",
    "editor.foreground": "#EDF7F5",
    "editorLineNumber.foreground": "#3E5868",
    "editorLineNumber.activeForeground": "#9FB4BE",
    "editor.lineHighlightBackground": "#0F202C",
    "editor.selectionBackground": "#1d4a5a",
    "editorGutter.background": "#08131B",
    "diffEditor.insertedTextBackground": "#39D98A26",
    "diffEditor.removedTextBackground": "#FF5C7A2E",
    "diffEditor.insertedLineBackground": "#39D98A14",
    "diffEditor.removedLineBackground": "#FF5C7A17",
    "scrollbarSlider.background": "#1d334388",
    "editorOverviewRuler.border": "#00000000",
  },
});

loader.config({ monaco });
export { monaco };
