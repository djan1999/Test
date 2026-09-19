// PostgREST caps each response. A catalogue/planner read must not silently
// become its first page; build a fresh, deterministically ordered query per page.
export async function readAllRows(buildQuery, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
