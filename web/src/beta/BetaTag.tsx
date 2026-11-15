import { BUILD_SHA, BUILD_TAG } from "../buildInfo";

/** Visible marker for experimental blocks (web/src/beta): the text names the build it is a snapshot of.
 *  A tight slot can hide the word "snapshot" with `.beta-tag-more` (#295); the title keeps the full text. */
export function BetaTag() {
  return (
    <span
      className="beta-tag"
      title={`Experimental snapshot of build ${BUILD_TAG} (${BUILD_SHA}), may change or be removed`}
    >
      BETA {BUILD_TAG}
      <span className="beta-tag-more"> snapshot</span>
    </span>
  );
}
