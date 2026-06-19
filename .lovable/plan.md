## Plan

1. **Fix the column detail crash shown in the screenshot**
   - Update the column detail page so it does not throw a full-page error when a column is missing or still loading.
   - Replace fragile not-found behavior with the existing inline “Column not found” diagnostic state.

2. **Add a direct server fallback for column detail**
   - If the column is not present in the client-side lab store after bootstrap, fetch that single column by ID from the server as the signed-in user.
   - This covers cases where the list has the column, but a direct detail route opens before or outside the hydrated store.

3. **Keep diagnostics only when truly not found**
   - If the server fallback also cannot find the row, show the diagnostic panel with the URL column ID and loaded IDs instead of the generic “This page didn’t load” screen.

4. **No SQL yet**
   - Based on the screenshot, this is currently an app route/runtime failure, not enough evidence for a database migration.
   - After the fix, SQL is only needed if the page loads the diagnostic panel showing `Columns loaded: 0` while your database definitely has rows for that user.

## Technical details

- Add a small authenticated server function such as `getColumnById` in `src/lib/lab.functions.ts`, reusing the existing `mapColumn` mapper.
- Update `src/routes/_shell.columns.$columnId.tsx` to use that fallback via React Query / server function instead of relying only on `useLab().columns`.
- Avoid editing `src/routeTree.gen.ts`; it is generated automatically.