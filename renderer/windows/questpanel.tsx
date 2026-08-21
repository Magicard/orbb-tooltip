import { createRoot } from "react-dom/client";
import { QuestPanel } from "../pages/QuestPanel";
import "../styles/index.css";
import React from "react";

const root = createRoot(document.getElementById("root") as Element);

root.render(<QuestPanel />);
