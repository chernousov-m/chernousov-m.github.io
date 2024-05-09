import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

export default (() => {
    const Links: QuartzComponent = () => {
        return (
            <div class="site-title">
                <h2>SwiftAddict</h2>
            </div>
        )
    }
    return Links
}) satisfies QuartzComponentConstructor
