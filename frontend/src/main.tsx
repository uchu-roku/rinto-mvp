// src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

import { registerSW } from "virtual:pwa-register";
registerSW(); // そのままでOK（オプションは任意）

// ※ Toaster をここに置く場合は↓を有効化
// import { Toaster } from "react-hot-toast";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* <Toaster position="top-center" /> */}
    <App />
  </React.StrictMode>
);
