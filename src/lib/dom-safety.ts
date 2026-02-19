/**
 * Patches Node.prototype.removeChild and Node.prototype.insertBefore to prevent
 * Chrome autofill/form assistant DOM mutations from crashing React's reconciler.
 *
 * Chrome's autofill (active in normal mode, disabled in incognito) injects
 * invisible nodes around form elements. When React tries to reconcile its
 * virtual DOM against the actual DOM, it calls removeChild/insertBefore on
 * nodes whose parentNode has been changed by Chrome, throwing NotFoundError:
 * "The object can not be found here."
 *
 * This is a well-known React 18+ issue. See:
 * https://github.com/facebook/react/issues/17256
 */
export function patchDomForAutofillSafety(): void {
  if (typeof window === 'undefined' || typeof Node === 'undefined') return;

  // Guard: only patch once
  if ((Node.prototype as any).__domSafetyPatched) return;
  (Node.prototype as any).__domSafetyPatched = true;

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      console.warn('[DOM Safety] removeChild: child not found — likely Chrome autofill interference');
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(newNode: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) {
      console.warn('[DOM Safety] insertBefore: ref not found — likely Chrome autofill interference');
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, ref) as T;
  };
}
