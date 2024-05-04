import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

export interface ShowSomethingOptions {
  default: boolean
  key: string
  component: QuartzComponent
}

export default ((opts?: ShowSomethingOptions) => {
  if (opts) {
    const Component = opts.component
    const HideSomething: QuartzComponent = (props: QuartzComponentProps) => {
      var show = opts.default
      if (props.fileData.frontmatter && props.fileData.frontmatter['show-' + opts.key]) {
        show = props.fileData.frontmatter['show-' + opts.key] == 'true'
      }
      if (!show) {
        return <></>
      }
      return <Component {...props} />
    }

    HideSomething.displayName = opts.component.displayName
    HideSomething.afterDOMLoaded = opts.component?.afterDOMLoaded
    HideSomething.beforeDOMLoaded = opts.component?.beforeDOMLoaded
    HideSomething.css = opts.component?.css
    return HideSomething
  } else {
    return () => <></>
  }
}) satisfies QuartzComponentConstructor