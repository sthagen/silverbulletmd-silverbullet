import type { System } from "../lib/plugos/system.ts";
import type { ScriptObject } from "../plugs/index/script.ts";
import {
  LuaEnv,
  LuaFunction,
  LuaRuntimeError,
  LuaStackFrame,
} from "$common/space_lua/runtime.ts";
import { parse as parseLua } from "$common/space_lua/parse.ts";
import { evalStatement } from "$common/space_lua/eval.ts";
import { jsToLuaValue } from "$common/space_lua/runtime.ts";
import {
  type PageRef,
  parsePageRef,
} from "@silverbulletmd/silverbullet/lib/page_ref";
import type { ScriptEnvironment } from "$common/space_script.ts";
import { luaValueToJS } from "$common/space_lua/runtime.ts";
import type { ASTCtx } from "$common/space_lua/ast.ts";
import type { ObjectQuery } from "@silverbulletmd/silverbullet/types";
import { buildLuaEnv } from "$common/space_lua_api.ts";

export class SpaceLuaEnvironment {
  env: LuaEnv = new LuaEnv();

  /**
   * Loads all Lua scripts from the database and evaluates them in a new environment
   * @param system
   */
  async reload(system: System<any>, scriptEnv: ScriptEnvironment) {
    const allScripts: ScriptObject[] = await system.invokeFunction(
      "index.queryObjects",
      ["space-lua", {
        // This is a bit silly, but at least makes the order deterministic
        orderBy: [{ expr: ["attr", "ref"] }],
      } as ObjectQuery],
    );
    this.env = buildLuaEnv(system, scriptEnv);
    for (const script of allScripts) {
      try {
        const ast = parseLua(script.script, { ref: script.ref });
        // We create a local scope for each script
        const scriptEnv = new LuaEnv(this.env);
        const sf = new LuaStackFrame(new LuaEnv(), ast.ctx);
        await evalStatement(ast, scriptEnv, sf);
      } catch (e: any) {
        if (e instanceof LuaRuntimeError) {
          const origin = resolveASTReference(e.sf.astCtx!);
          if (origin) {
            console.error(
              `Error evaluating script: ${e.message} at [[${origin.page}@${origin.pos}]]`,
            );
            continue;
          }
        }
        console.error(
          `Error evaluating script: ${e.message} for script: ${script.script}`,
        );
      }
    }

    // Find all functions and register them
    for (const globalName of this.env.keys()) {
      const value = this.env.get(globalName);
      if (value instanceof LuaFunction) {
        console.log("Now registering Lua function", globalName);
        scriptEnv.registerFunction({ name: globalName }, (...args: any[]) => {
          const sf = new LuaStackFrame(new LuaEnv(), value.body.ctx);
          return luaValueToJS(value.call(sf, ...args.map(jsToLuaValue)));
        });
      }
    }
    console.log("Loaded", allScripts.length, "Lua scripts");
  }
}

export function resolveASTReference(ctx?: ASTCtx): PageRef | null {
  if (!ctx?.ref) {
    return null;
  }
  const pageRef = parsePageRef(ctx.ref);
  return {
    page: pageRef.page,
    pos: (pageRef.pos as number) + "```space-lua\n".length + ctx.from!,
  };
}
