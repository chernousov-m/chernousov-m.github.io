import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

export interface Link {
    url: string
    title: string
}

export interface LinksOptions {
    links: Link[]
}

export default ((opts?: LinksOptions) => {
    const Links: QuartzComponent = () => {
        if (opts) {
        return (
                <div class="links">
                    {opts.links.map((link) => (
                        <a href={link.url}>{link.title}</a>
                    ))}
                </div>
            )
        } else {
            return null
        }
    }
    return Links
}) satisfies QuartzComponentConstructor
