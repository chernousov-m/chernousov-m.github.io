import { QuartzTransformerPlugin } from "../types"
import rehypeHighlight from 'rehype-highlight'
import hljs, { LanguageFn, Mode } from "highlight.js"
import swift from "highlight.js/lib/languages/swift"
import { format } from "path"

export const HLJSSyntaxHighlighting: QuartzTransformerPlugin<undefined> = () => {
  var mySwift: LanguageFn = (api) => {
    var current = swift(api)
    var directive: (str: string) => Mode = (str) => {
      var token = str.replace("-", "_").toUpperCase()
      return {
        className: str,
        begin: RegExp("\\/\\*@START_" + token + "@\\*\\/"),
        end: RegExp("\\/\\*@END_" + token + "@\\*\\/"),
      }
    }
    return {
      name: current.name,
      unicodeRegex: current.unicodeRegex,
      rawDefinition: current.rawDefinition,
      aliases: current.aliases,
      disableAutodetect: current.disableAutodetect,
      contains: [
        directive('menu-token'),
        directive('highlight'),
        ...current.contains,
      ],
      case_insensitive: current.case_insensitive,
      keywords: current.keywords,
      isCompiled: current.isCompiled,
      exports: current.exports,
      classNameAliases: current.classNameAliases,
      compilerExtensions: current.compilerExtensions,
      supersetOf: current.supersetOf,
    }
  }
  return {
    name: "SyntaxHighlighting",
    htmlPlugins() {
      return [[rehypeHighlight, {languages: {swift: mySwift}}]]
    },
  }
}

// export interface LanguageDetail {
//   name?: string
//   unicodeRegex?: boolean
//   rawDefinition?: () => Language
//   aliases?: string[]
//   disableAutodetect?: boolean
//   contains: (Mode)[]
//   case_insensitive?: boolean
//   keywords?: string | string[] | Record<string, string | string[]>
//   isCompiled?: boolean,
//   exports?: any,
//   classNameAliases?: Record<string, string>
//   compilerExtensions?: CompilerExt[]
//   supersetOf?: string
// }