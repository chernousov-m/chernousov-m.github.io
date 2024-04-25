import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/footer.scss"
import hljsscript from "./scripts/hljs.inline"
import { version } from "../../package.json"
import { i18n } from "../i18n"
import hljs from "highlight.js"

interface Options {
  links: Record<string, string>
}

export default ((opts?: Options) => {
  const CustomFooter: QuartzComponent = ({ displayClass, cfg }: QuartzComponentProps) => {
    const year = new Date().getFullYear()
    const links = opts?.links ?? []
    return (
      <footer class={`${displayClass ?? ""}`}>
        <hr />
        <p>
          {year} © Chernousov Maxim
        </p>
        <ul>
          {Object.entries(links).map(([text, link]) => (
            <li>
              <a href={link}>{text}</a>
            </li>
          ))}
        </ul>
      </footer>
    )
  }

  CustomFooter.css = style
  CustomFooter.beforeDOMLoaded = hljsscript
  return CustomFooter
}) satisfies QuartzComponentConstructor
