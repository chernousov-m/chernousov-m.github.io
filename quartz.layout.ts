import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"
import CustomFooter from './quartz/components/CustomFooter'
import Links from "./quartz/components/Links"
import HideSomething from "./quartz/components/HideSomething"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [
    Links({
      links: [
        { url: "/", title: 'Blog'}
      ]
    }),
    Links({
      links: [
        { url: "/notes", title: 'Notes'}
      ]
    }),
    Component.Search()
  ],
  footer: CustomFooter({
    links: {
      GitHub: "https://github.com/chernousov-m"
    },
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    HideSomething({
      key: 'content-meta',
      component: Component.ContentMeta({showReadingTime: false})
    }),
  ],
  left: [],
  right: [],
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [],
  left: [],
  right: [],
}
