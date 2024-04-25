import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

export interface HideSomethingOptions {
  key: string
  component: QuartzComponent
}

export default ((opts?: HideSomethingOptions) => {
  if (opts) {
    const Component = opts.component
    const HideSomething: QuartzComponent = (props: QuartzComponentProps) => {
      if (props.fileData.frontmatter && props.fileData.frontmatter["hide-" + opts.key] == "true") {
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
