import { collectNodesOfType, findNodeOfType, replaceNodesMatching } from "../../common/tree";
import { lezerToParseTree } from "../../common/parse_tree";

// @ts-ignore
import { parser } from "./parse-query";

type Filter = {
  op: string;
  prop: string;
  value: any;
};

type ParsedQuery = {
  table: string;
  orderBy?: string;
  orderDesc?: boolean;
  limit?: number;
  filter: Filter[];
};

export function parseQuery(query: string): ParsedQuery {
  let n = lezerToParseTree(query, parser.parse(query).topNode);
  // Clean the tree a bit
  replaceNodesMatching(n, (n) => {
    if (!n.type) {
      let trimmed = n.text!.trim();
      if (!trimmed) {
        return null;
      }
      n.text = trimmed;
    }
  });

  let queryNode = n.children![0];
  let parsedQuery: ParsedQuery = {
    table: queryNode.children![0].children![0].text!,
    filter: [],
  };
  let orderByNode = findNodeOfType(queryNode, "OrderClause");
  if (orderByNode) {
    let nameNode = findNodeOfType(orderByNode, "Name");
    parsedQuery.orderBy = nameNode!.children![0].text!;
    let orderNode = findNodeOfType(orderByNode, "Order");
    parsedQuery.orderDesc = orderNode
      ? orderNode.children![0].text! === "desc"
      : false;
  }
  let limitNode = findNodeOfType(queryNode, "LimitClause");
  if (limitNode) {
    let nameNode = findNodeOfType(limitNode, "Number");
    parsedQuery.limit = +nameNode!.children![0].text!;
  }
  let filterNodes = collectNodesOfType(queryNode, "FilterExpr");
  for (let filterNode of filterNodes) {
    let val: any = undefined;
    let valNode = filterNode.children![2].children![0];
    switch (valNode.type) {
      case "Number":
        val = valNode.children![0].text!;
        break;
      case "Bool":
        val = valNode.children![0].text! === "true";
        break;
      case "Name":
        val = valNode.children![0].text!;
        break;
      case "String":
        val = valNode.children![0].text!;
        val = val.substring(1, val.length - 1);
        break;
    }
    let f: Filter = {
      prop: filterNode.children![0].children![0].text!,
      op: filterNode.children![1].text!,
      value: val,
    };
    parsedQuery.filter.push(f);
  }
  // console.log(JSON.stringify(queryNode, null, 2));
  return parsedQuery;
}

export function applyQuery(query: string, records: any[]): any {
  const parsedQuery = parseQuery(query);

  let resultRecords: any[] = [];
  if (parsedQuery.filter.length === 0) {
    resultRecords = records.slice();
  } else {
    recordLoop: for (let record of records) {
      for (let { op, prop, value } of parsedQuery.filter) {
        switch (op) {
          case "=":
            if (!(record[prop] === value)) {
              continue recordLoop;
            }
            break;
          case "!=":
            if (!(record[prop] !== value)) {
              continue recordLoop;
            }
            break;
          case "<":
            if (!(record[prop] < value)) {
              continue recordLoop;
            }
            break;
          case "<=":
            if (!(record[prop] <= value)) {
              continue recordLoop;
            }
            break;
          case ">":
            if (!(record[prop] > value)) {
              continue recordLoop;
            }
            break;
          case ">=":
            if (!(record[prop] >= value)) {
              continue recordLoop;
            }
            break;
          case "like":
            let re = new RegExp(value.replaceAll("%", ".*"));
            if (!re.exec(record[prop])) {
              continue recordLoop;
            }
            break;
        }
      }
      resultRecords.push(record);
    }
  }
  // Now the sorting
  if (parsedQuery.orderBy) {
    resultRecords = resultRecords.sort((a: any, b: any) => {
      const orderBy = parsedQuery.orderBy!;
      const orderDesc = parsedQuery.orderDesc!;
      if (a[orderBy] === b[orderBy]) {
        return 0;
      }

      if (a[orderBy] < b[orderBy]) {
        return orderDesc ? 1 : -1;
      } else {
        return orderDesc ? -1 : 1;
      }
    });
  }
  if (parsedQuery.limit) {
    resultRecords = resultRecords.slice(0, parsedQuery.limit);
  }
  return resultRecords;
}
