/**
 * responsive breakpoints
 *
 * CSS media queries can't use CSS variables, so we document the values here
 * as the single source of truth. when changing breakpoints, update both this
 * file and the corresponding @media queries in components.
 *
 * usage in components:
 *   @media (max-width: 768px) { ... }  // mobile
 *   @media (max-width: 1100px) { ... } // header mobile (needs margin space)
 */

/** standard mobile breakpoint - used by most components */
export const MOBILE_BREAKPOINT = 768;

/** small mobile breakpoint - extra compact styles */
export const MOBILE_SMALL_BREAKPOINT = 480;

/**
 * header mobile breakpoint - higher because header has margin-positioned
 * elements (stats, search, logout) that need space outside the 800px content area.
 *
 * calculation: 800px content + ~300px for margin elements = ~1100px minimum
 */
export const HEADER_MOBILE_BREAKPOINT = 1100;

/** content max-width used across pages */
export const CONTENT_MAX_WIDTH = 800;

/** queue panel width */
export const QUEUE_WIDTH = 360;
