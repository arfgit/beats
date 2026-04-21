import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startServiceWorker } from "./lib/registerSW";
import "./styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startServiceWorker();
