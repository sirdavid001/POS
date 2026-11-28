// Keep both interfaces in sync with the server's role policy.
export function canIssueStaffCard(actorRole, subjectRole) {
  return actorRole === 'manager' && subjectRole === 'cashier'
    || actorRole === 'admin' && ['manager', 'admin'].includes(subjectRole);
}
