export const CAS_EXHAUSTED_CODE = "MILKA_CAS_EXHAUSTED";

// A compare-and-swap loop that has already lost several consecutive races is
// a conflict verdict, not a network outage. Retrying the same PowerSync
// transaction forever blocks every later upload (and checkpoint) on the
// device. Give the connector a typed signal so it can preserve server truth,
// surface the lost local edit, and let synchronization continue.
export function casExhaustedError(message) {
  const error = new Error(message);
  error.code = CAS_EXHAUSTED_CODE;
  return error;
}
