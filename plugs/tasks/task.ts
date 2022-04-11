import type { ClickEvent } from "../../webapp/app_event";
import { IndexEvent } from "../../webapp/app_event";

import { whiteOutQueries } from "../query/materialized_queries";
import { batchSet } from "plugos-silverbullet-syscall/index";
import { readPage, writePage } from "plugos-silverbullet-syscall/space";
import { parseMarkdown } from "plugos-silverbullet-syscall/markdown";
import { dispatch, getText } from "plugos-silverbullet-syscall/editor";
import {
  addParentPointers,
  collectNodesMatching,
  collectNodesOfType,
  nodeAtPos,
  renderToText
} from "../../common/tree";

type Task = {
  task: string;
  complete: boolean;
  deadline?: string;
  pos?: number;
  nested?: string;
};

export async function indexTasks({ name, text }: IndexEvent) {
  console.log("Indexing tasks");
  let tasks: { key: string; value: Task }[] = [];
  text = whiteOutQueries(text);
  let mdTree = await parseMarkdown(text);
  addParentPointers(mdTree);
  collectNodesOfType(mdTree, "Task").forEach((n) => {
    let task = n.children!.slice(1).map(renderToText).join("").trim();
    let complete = n.children![0].children![0].text! !== "[ ]";
    let value: Task = {
      task,
      complete,
    };

    let deadlineNodes = collectNodesOfType(n, "DeadlineDate");
    if (deadlineNodes.length > 0) {
      value.deadline = deadlineNodes[0].children![0].text!.replace(/📅\s*/, "");
    }

    let taskIndex = n.parent!.children!.indexOf(n);
    let nestedItems = n.parent!.children!.slice(taskIndex + 1);
    if (nestedItems.length > 0) {
      value.nested = nestedItems.map(renderToText).join("").trim();
    }
    tasks.push({
      key: `task:${n.from}`,
      value,
    });
    // console.log("Task", value);
  });

  console.log("Found", tasks.length, "task(s)");
  await batchSet(name, tasks);
}

export async function taskToggle(event: ClickEvent) {
  return taskToggleAtPos(event.pos);
}

export async function taskToggleAtPos(pos: number) {
  let text = await getText();
  let mdTree = await parseMarkdown(text);
  addParentPointers(mdTree);

  let node = nodeAtPos(mdTree, pos);
  if (node && node.type === "TaskMarker") {
    let changeTo = "[x]";
    if (node.children![0].text === "[x]" || node.children![0].text === "[X]") {
      changeTo = "[ ]";
    }
    await dispatch({
      changes: {
        from: node.from,
        to: node.to,
        insert: changeTo,
      },
      selection: {
        anchor: pos,
      },
    });

    let parentWikiLinks = collectNodesMatching(
      node.parent!,
      (n) => n.type === "WikiLinkPage"
    );
    for (let wikiLink of parentWikiLinks) {
      let ref = wikiLink.children![0].text!;
      if (ref.includes("@")) {
        let [page, pos] = ref.split("@");
        let pageData = await readPage(page);
        let text = pageData.text;

        let referenceMdTree = await parseMarkdown(text);
        // Adding +1 to immediately hit the task marker
        let taskMarkerNode = nodeAtPos(referenceMdTree, +pos + 1);

        if (!taskMarkerNode || taskMarkerNode.type !== "TaskMarker") {
          console.error(
            "Reference not a task marker, out of date?",
            taskMarkerNode
          );
          return;
        }
        taskMarkerNode.children![0].text = changeTo;
        console.log(
          "This will be the new marker",
          renderToText(taskMarkerNode)
        );
        text = renderToText(referenceMdTree);
        console.log("Updated reference paged text", text);
        await writePage(page, text);
      }
    }
  }
}
