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
    var directives = [
      directive('menu-token'),
      directive('highlight'),
    ]
    return {
      name: current.name,
      unicodeRegex: current.unicodeRegex,
      rawDefinition: current.rawDefinition,
      aliases: current.aliases,
      disableAutodetect: current.disableAutodetect,
      contains: [
        ...directives,
        ...current.contains.map((mode) => { return add(directives, mode, 0) }),
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

function add(directives: (Mode | 'self')[], mode: Mode | 'self', depth: number): (Mode | 'self') {
  if (typeof mode === 'string') {
    return mode
  } else {
    return {
      begin: mode.begin,
      match: mode.match,
      end: mode.end,
      // deprecated in favor of `scope`
      className: mode.className,
      scope: mode.scope,
      beginScope: mode.beginScope,
      endScope: mode.endScope,
      contains: directives.concat(mode.contains?.flatMap((mode) => { if (depth < 10) { return [add(directives, mode, depth + 1)] } else { return directives.concat([mode]) }}) ?? []),
      endsParent: mode.endsParent,
      endsWithParent: mode.endsWithParent,
      endSameAsBegin: mode.endSameAsBegin,
      skip: mode.skip,
      excludeBegin: mode.excludeBegin,
      excludeEnd: mode.excludeEnd,
      returnBegin: mode.returnBegin,
      returnEnd: mode.returnEnd,
      __beforeBegin: mode.__beforeBegin,
      parent: mode.parent,
      starts: mode.starts,
      lexemes: mode.lexemes,
      keywords: mode.keywords,
      beginKeywords: mode.beginKeywords,
      relevance: mode.relevance,
      illegal: mode.illegal,
      variants: mode.variants,
      cachedVariants: mode.cachedVariants,
      // parsed
      subLanguage: mode.subLanguage,
      isCompiled: mode.isCompiled,
      label: mode.label,

      "on:end": mode["on:end"],
      "on:begin": mode["on:begin"]
    }
  }
}

type Trampoline<A> = Recurse<A> | Value<A>

interface Recurse<A> {
    _tag: 'Recurse',
    recurse: () => Trampoline<A>,
}

interface Value<A> {
    _tag: 'Value',
    value: A,
}


const recurse = <A>(f: () => Trampoline<A>): Recurse<A> =>
    ({ _tag: 'Recurse', recurse: f })


const value = <A>(a: A): Value<A> =>
    ({ _tag: 'Value', value: a })

// export interface LanguageDetail {
//   name: string
//   unicodeRegex: boolean
//   rawDefinition: () => Language
//   aliases: string[]
//   disableAutodetect: boolean
//   contains: (Mode)[]
//   case_insensitive: boolean
//   keywords: string | string[] | Record<string, string | string[]>
//   isCompiled: boolean,
//   exports: any,
//   classNameAliases: Record<string, string>
//   compilerExtensions: CompilerExt[]
//   supersetOf: string
// }