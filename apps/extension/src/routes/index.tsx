import { createFileRoute } from "@tanstack/react-router";
import App from "../popup/App";

export const Route = createFileRoute("/")({ component: App });
