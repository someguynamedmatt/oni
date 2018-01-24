export interface IGitWindowOptions {
    foregroundColor?: string,
    backgroundColor?: string
}

export interface IShowGitWindowAction {
    type: "SHOW_GIT_WINDOW",
    payload: {
        options?: IGitWindowOptions,
    }
}

export interface IHideGitWindowAction {
    type: "HIDE_GIT_WINDOW"
}

export type GitWindowAction =
    IShowGitWindowAction |
    IHideGitWindowAction
