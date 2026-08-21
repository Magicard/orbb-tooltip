import { createRoot } from "react-dom/client";
import { MapView } from "../pages/MapView";
import "../styles/index.css";
import React from "react";

const root = createRoot(document.getElementById("root") as Element);

root.render(<MapView />);
