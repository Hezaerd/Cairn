import React from "react";
import ReactDOM from "react-dom/client";
import Picker from "./Picker";
import { followSystemTheme } from "../theme";
import "../style.css";

const root = document.getElementById("root");

if (!root) throw new Error("Missing application root");

followSystemTheme();

document.documentElement.lang = chrome.i18n.getMessage("@@ui_locale").replace("_", "-");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Picker />
  </React.StrictMode>,
);
