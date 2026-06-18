/**
 * Type augmentation for framer-motion v12 + React 19.
 *
 * The motion-dom package (a dependency of framer-motion v12) ships without
 * TypeScript declarations, which causes HTMLMotionProps to miss animation
 * props like `animate`, `initial`, `exit`, and `transition`.
 *
 * This declaration file patches the missing types so `tsc --noEmit` passes.
 * It must be in the `include` path of tsconfig.json (src/** is included).
 */
import 'framer-motion';

declare module 'framer-motion' {
  export interface HTMLMotionProps<T> {
    initial?: any;
    animate?: any;
    exit?: any;
    transition?: any;
    variants?: any;
    whileHover?: any;
    whileTap?: any;
    whileDrag?: any;
    whileFocus?: any;
    whileInView?: any;
    viewport?: any;
    drag?: any;
    dragConstraints?: any;
    dragElastic?: any;
    dragMomentum?: any;
    dragTransition?: any;
    dragSnapToOrigin?: any;
    dragPropagation?: any;
    dragControls?: any;
    onDragStart?: any;
    onDrag?: any;
    onDragEnd?: any;
    onDirectionLock?: any;
    layout?: any;
    layoutId?: any;
    layoutDependency?: any;
    layoutScroll?: any;
    layoutRoot?: boolean;
    onLayoutAnimationStart?: any;
    onLayoutAnimationComplete?: any;
    onLayoutMeasure?: any;
    custom?: any;
    inherit?: boolean;
    transformTemplate?: any;
    onAnimationStart?: any;
    onAnimationComplete?: any;
    onUpdate?: any;
    onViewportEnter?: any;
    onViewportLeave?: any;
  }
}
