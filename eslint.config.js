// The Firebase security-rules plugin was the only thing configured here, and
// there are no Firestore rules any more - authorisation lives in the API.
export default [
  {
    ignores: ['dist/**/*', 'api/dist/**/*', 'node_modules/**/*']
  }
];
