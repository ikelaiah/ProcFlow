/* proc>flow: conservative editor policy for inputs that are expensive to
   analyse repeatedly while a user is still typing. */
var PROCFLOW_LARGE_INPUT_THRESHOLD=100000;

interface LargeInputPolicy {
  large: boolean;
  length: number;
  threshold: number;
}

function largeInputPolicy(length: number): LargeInputPolicy {
  var size=Math.max(0,Number(length)||0);
  return {large:size>=PROCFLOW_LARGE_INPUT_THRESHOLD,
          length:size,threshold:PROCFLOW_LARGE_INPUT_THRESHOLD};
}
