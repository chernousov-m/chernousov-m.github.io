import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"
import CustomFooter from './quartz/components/CustomFooter'
import Link from "./quartz/components/Link"
import ShowSomething from "./quartz/components/ShowSomething"
import SiteTitle from "./quartz/components/SiteTitle"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [
    SiteTitle(),
    Link({
      links: [
        { url: "/", title: 'Blog'}
      ]
    }),
    Link({
      links: [
        { url: "/notes", title: 'Notes'}
      ]
    }),
  ],
  footer: CustomFooter({
    links: {
      GitHub: "https://github.com/chernousov-m",
      LinkedIn: "https://www.linkedin.com/in/maksim-chernousov",
    },
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.Search(),
    ShowSomething({
      default: true,
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
