/** Author associations that imply write access to the repository. */
const WRITE_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export interface CommandActor {
  /** Login of the person who left the comment. */
  commenter: string;
  /** Login of the PR author, who may correct their own entry. */
  prAuthor: string;
  /** GitHub `author_association` of the commenter on this thread. */
  association: string;
}

/** Gated to the PR author and users with write access; applies to every command, reclassify included. */
export function canRunCommands(actor: CommandActor): boolean {
  if (WRITE_ASSOCIATIONS.has(actor.association.toUpperCase())) return true;
  return actor.commenter === actor.prAuthor;
}
