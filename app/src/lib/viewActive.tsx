import { createContext, useContext } from "react";

/** True while this panel's tab is the visible one. Panels are kept mounted when you switch away (so state and data survive);
 *  use this to pause polling and animations while hidden. */
export const ViewActiveContext = createContext(true);
export const useViewActive = () => useContext(ViewActiveContext);
