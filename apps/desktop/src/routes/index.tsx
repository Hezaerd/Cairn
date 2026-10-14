import { createFileRoute } from "@tanstack/react-router";
import App from "../App";

// The view and its selection live in the navigation store, so they survive settings and restarts.
export const Route = createFileRoute("/")({ component: App });
