import React from "react";
import ReactDOM from "react-dom/client";
import Save from "./Save";
import { followSystemTheme } from "../theme";
import "../style.css";

const root = document.getElementById("root");

if (!root) throw new Error("Missing application root");

followSystemTheme();

document.documentElement.lang = chrome.i18n.getMessage("@@ui_locale").replace("_", "-");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Save />
  </React.StrictMode>,
);
