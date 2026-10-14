import React from "react";
import ReactDOM from "react-dom/client";
import Picker from "./Picker";
import "../popup/style.css";
import "./style.css";

const root = document.getElementById("root");

if (!root) throw new Error("Missing application root");

document.documentElement.lang = chrome.i18n.getMessage("@@ui_locale").replace("_", "-");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Picker />
  </React.StrictMode>,
);
