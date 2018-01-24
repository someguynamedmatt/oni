import * as React from "react"
import { connect, Provider } from "react-redux"

import * as Oni from "oni-api"

export interface IGitWindowProps {
    visible: boolean
    backgroundColor: string
    foregroundColor: string
}

export class GitWindowView extends React.PureComponent<IGitWindowProps, {}> {

    public render(): null | JSX.Element {
        if (!this.props.visible) {
            return null
        }

        return <div>
            <span>Git Window</span>
        </div>
    }
}
