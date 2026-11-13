// The feature bundle for `LazyMotion`, in its own module so it is fetched on demand (after the
// first paint) instead of shipping with every page. `domMax` is the bundle with layout animation.
import { domMax } from "motion/react";

export default domMax;
