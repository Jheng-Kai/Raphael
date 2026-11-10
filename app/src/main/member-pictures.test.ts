import { beforeEach, expect, test, vi } from "vitest";

type Call = { method: string; params: Record<string, unknown> };
const { invoke, picture } = vi.hoisted(() => ({
  invoke: vi.fn(),
  // What the core holds: the picture of each (kind, member) and its revision.
  picture: { avatar: { 1: { rev: "a1", url: "data:image/png;base64,AAAA" }, 0: { rev: "z0", url: "data:image/png;base64,ZZZZ" } },
    cover: { 1: { rev: "c1", url: "data:image/jpeg;base64,CCCC" } } } as Record<string, Record<number, { rev: string; url: string }>>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
import { forgetPictures } from "./member-pictures";
import { membersList, membersUpdate } from "./api";

const asked = (): Call[] => invoke.mock.calls.filter(([command]) => command === "core_call").map(([, args]) => args as Call);
const pictureReads = (): Call[] => asked().filter(call => call.method === "members.picture");
const roster = () => ({ members: [
  { id: 0, name: "Raphael", avatar: "", avatar_rev: "z0" },
  { id: 1, name: "Moss", avatar: "file:moss.png", avatar_rev: picture.avatar[1]!.rev, cover: { kind: "image", rev: picture.cover[1]!.rev, position: 40 } },
  { id: 2, name: "Fern", avatar: "slime:green" },
], groups: [] });

beforeEach(() => {
  picture.avatar[1] = { rev: "a1", url: "data:image/png;base64,AAAA" };
  forgetPictures();
  invoke.mockReset();
  invoke.mockImplementation(async (_command: string, args: Call) => {
    if (args.method === "members.picture") {
      const found = picture[String(args.params.kind)]?.[Number(args.params.id)];
      return found ?? { rev: null, url: null };
    }
    if (args.method === "members.list") return roster();
    if (args.method === "members.update") return { member: roster().members[1] };
    return {};
  });
});

test("the roster carries no picture and the faces get theirs from the core once", async () => {
  const list = await membersList();
  expect(list.members[0]!.avatar_url).toBe("data:image/png;base64,ZZZZ");
  expect(list.members[1]!.avatar_url).toBe("data:image/png;base64,AAAA");
  expect(list.members[1]!.cover).toMatchObject({ kind: "image", url: "data:image/jpeg;base64,CCCC", position: 40 });
  expect(list.members[2]!.avatar_url).toBeUndefined();
  expect(pictureReads()).toHaveLength(3);

  // Read again, the same revisions are shown from what is kept: no picture is asked for twice.
  const again = await membersList();
  expect(again.members[1]!.avatar_url).toBe("data:image/png;base64,AAAA");
  expect(pictureReads()).toHaveLength(3);
});

test("a picture the owner changed has a new revision and is read again", async () => {
  expect((await membersList()).members[1]!.avatar_url).toBe("data:image/png;base64,AAAA");
  picture.avatar[1] = { rev: "a2", url: "data:image/png;base64,BBBB" };
  expect((await membersList()).members[1]!.avatar_url).toBe("data:image/png;base64,BBBB");
  expect(pictureReads().filter(call => call.params.id === 1 && call.params.kind === "avatar")).toHaveLength(2);
  // Going back to the old revision reads it again: the one that was replaced is not kept.
  picture.avatar[1] = { rev: "a1", url: "data:image/png;base64,AAAA" };
  expect((await membersList()).members[1]!.avatar_url).toBe("data:image/png;base64,AAAA");
  expect(pictureReads().filter(call => call.params.id === 1 && call.params.kind === "avatar")).toHaveLength(3);
});

test("a member that comes back from an update gets its picture too, and a picture that cannot be read leaves the silhouette", async () => {
  const { member } = await membersUpdate(1, { name: "Moss" });
  expect(member.avatar_url).toBe("data:image/png;base64,AAAA");
  forgetPictures();
  invoke.mockImplementation(async (_command: string, args: Call) => {
    if (args.method === "members.picture") throw new Error("gone");
    return roster();
  });
  const list = await membersList();
  expect(list.members[1]!.avatar_url).toBeUndefined();
  expect(list.members[1]!.cover).toMatchObject({ kind: "image", url: "" });
});

test("a picture asked for at once from two places is read once", async () => {
  await Promise.all([membersList(), membersList("en")]);
  expect(pictureReads().filter(call => call.params.kind === "avatar" && call.params.id === 1)).toHaveLength(1);
});
