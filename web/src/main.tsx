import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { installPreloadReload } from "./preloadReload";

installPreloadReload();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
