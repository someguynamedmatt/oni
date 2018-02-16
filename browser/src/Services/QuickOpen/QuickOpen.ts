/**
 * QuickOpen.ts
 *
 * Manages the quick open menu
 */

import { lstatSync } from "fs"

import * as path from "path"

import * as Oni from "oni-api"

import { INeovimInstance } from "./../../neovim"

import { commandManager } from "./../CommandManager"
import { configuration } from "./../Configuration"
import { editorManager } from "./../EditorManager"
import { fuseFilter, Menu, MenuManager } from "./../Menu"

import { FinderProcess } from "./FinderProcess"
import { render as renderPinnedIcon } from "./PinnedIconView"
import { QuickOpenItem, QuickOpenType } from "./QuickOpenItem"
import { regexFilter } from "./RegExFilter"
import * as RipGrep from "./RipGrep"

import { getFileIcon } from "./../FileIcon"

export class QuickOpen {
    private _finderProcess: FinderProcess
    private _seenItems: string[] = []
    private _loadedItems: QuickOpenItem[] = []
    private _neovimInstance: INeovimInstance
    private _menu: Menu
    private _lastCommand: string | null = null

    constructor(menuManager: MenuManager, neovimInstance: INeovimInstance) {
        // console.log("DUDE constructor", menuManager, neovimInstance)
        this._neovimInstance = neovimInstance

        this._menu = menuManager.create()
        this._menu.onItemSelected.subscribe((selectedItem: any) => {
            this._onItemSelected(selectedItem)
        })

        this._menu.onHide.subscribe(() => {
            this._stopFinderProcess()
        })

        this._menu.onFilterTextChanged.subscribe((newFilter: any) => {
            if (this._isFinderCommandDynamic() && this._menu.isOpen()) {
                const commandWithFilter = this._getDynamicSearchCommand(
                    this._lastCommand,
                    newFilter,
                )
                this._updateFinderProcess(commandWithFilter)
            }
        })
    }

    public isOpen(): boolean {
        return this._menu && this._menu.isOpen()
    }

    public openFileNewTab(): void {
        const selectedItem = this._menu.selectedItem
        if (selectedItem) {
            this._onItemSelected(selectedItem, ":tabnew")
        }
    }

    public openFileHorizontal(): void {
        const selectedItem = this._menu.selectedItem
        if (selectedItem) {
            this._onItemSelected(selectedItem, ":sp")
        }
    }

    public openFileVertical(): void {
        const selectedItem = this._menu.selectedItem
        if (selectedItem) {
            this._onItemSelected(selectedItem, ":vsp")
        }
    }

    public async show() {
        // reset list and show loading indicator
        this._loadedItems = []

        const overriddenCommand = configuration.getValue("editor.quickOpen.execCommand")

        const filterStrategy = configuration.getValue("editor.quickOpen.filterStrategy")

        const useRegExFilter = filterStrategy === "regex"

        const filterFunction = useRegExFilter ? regexFilter : fuseFilter
        this._menu.setFilterFunction(filterFunction)

        //  If in exec directory or home, show bookmarks to change cwd to
        if (this._isInstallDirectoryOrHome()) {
            this._menu.show()
            this._loadDefaultMenuItems()

            // TODO consider adding folders as well (recursive async with ignores/excludes)
            // For now, sync call bookmarks and open folder, it's so few it's not going to matter
            await this._setItemsFromQuickOpenItems(this._loadedItems)
            return
        }

        // Overridden strategy
        if (overriddenCommand) {
            // replace placeholder ${search} with "" for initial case
            this.loadMenu(overriddenCommand) // tslint:disable-line no-invalid-template-strings
            return
        } else {
            // Default strategy
            const excludeFiles = configuration.getValue("oni.exclude")
            const command =
                RipGrep.getCommand() + " " + RipGrep.getArguments(excludeFiles).join(" ")
            this.loadMenu(command, "\n")
        }
    }

    public async showBufferLines() {
        let nu = 0

        const currentLines = await editorManager.activeEditor.activeBuffer.getLines()

        const options = currentLines.map((line: string) => {
            return {
                icon: QuickOpenItem.convertTypeToIcon(QuickOpenType.bufferLine),
                label: String(++nu),
                detail: line,
                // I don't think I want to pin these... pinned: false,
            }
        })

        this._menu.show()
        this._menu.setItems(options)
    }

    // Overridden strategy
    // If git repo, use git ls-files
    private loadMenu(command: string, splitCharacter: string = "\n") {
        this._menu.show()
        this._lastCommand = command

        this._menu.setItems([])
        this._loadedItems = []

        this._updateFinderProcess(this._getDynamicSearchCommand(command, ""), splitCharacter)
    }

    private _isFinderCommandDynamic(): boolean {
        return this._lastCommand && this._lastCommand.indexOf("${search}") >= 0 // tslint:disable-line no-invalid-template-strings
    }

    private _getDynamicSearchCommand(command: string, filterText: string): string {
        return command.replace("${search}", filterText) // tslint:disable-line no-invalid-template-strings
    }

    private _updateFinderProcess(command: string, splitCharacter: string = "\n"): void {
        this._menu.setItems([])
        this._loadedItems = []

        this._stopFinderProcess()

        let timeout = window.setTimeout(() => {
            this._menu.setLoading(true)
        }, 200)

        this._finderProcess = new FinderProcess(command, splitCharacter)

        this._finderProcess.onData.subscribe((newData: string[]) => {
            const newItems = newData.map((s: string) => new QuickOpenItem(s, QuickOpenType.file))
            this._loadedItems = this._loadedItems.concat(newItems)
            this._setItemsFromQuickOpenItems(this._loadedItems)
        })

        this._finderProcess.onComplete.subscribe(() => {
            this._menu.setLoading(false)

            if (timeout) {
                window.clearTimeout(timeout)
                timeout = null
            }
        })

        this._finderProcess.start()
    }

    private _closeMenu(): void {
        this._stopFinderProcess()
        this._menu.hide()
    }

    private _stopFinderProcess(): void {
        if (this._finderProcess) {
            this._finderProcess.stop()
            this._finderProcess = null
        }
    }

    private _onItemSelected(selectedOption: Oni.Menu.MenuOption, openInSplit: string = ":e"): void {
        const arg = selectedOption
        // console.log("DUDE arg", arg)
        // console.log("DUDE cwd", process.cwd())

        if (arg.icon === QuickOpenItem.convertTypeToIcon(QuickOpenType.bookmarkHelp)) {
            commandManager.executeCommand("oni.config.openConfigJs")
        } else if (arg.icon === QuickOpenItem.convertTypeToIcon(QuickOpenType.folderHelp)) {
            commandManager.executeCommand("oni.openFolder")
        } else if (arg.icon === QuickOpenItem.convertTypeToIcon(QuickOpenType.bufferLine)) {
            if (openInSplit !== "e") {
                this._neovimInstance.command(openInSplit + "!")
            }
            this._neovimInstance.command(`${arg.label}`)
        } else {
            // console.log("DUDE arg.detail", arg.detail)
            let fullPath = path.join(arg.detail, arg.label)
            // console.log("DUDE fullPath", fullPath)

            this._seenItems.push(fullPath)

            this._neovimInstance.command(openInSplit + "! " + fullPath)

            if (arg.icon === QuickOpenItem.convertTypeToIcon(QuickOpenType.folder)) {
                this._neovimInstance.chdir(fullPath)
            }

            // If we are bookmark, and we open a file, the open it's dirname
            // If we are a directory, open it.
            if (arg.icon === QuickOpenItem.convertTypeToIcon(QuickOpenType.bookmark)) {
                // If I use this one more place I'm going to make a function >.>
                fullPath = fullPath.replace(
                    "~",
                    process.env[process.platform === "win32" ? "USERPROFILE" : "HOME"],
                )

                if (lstatSync(fullPath).isDirectory()) {
                    this._neovimInstance.chdir(fullPath)
                } else {
                    this._neovimInstance.chdir(arg.detail)
                }
            }
        }

        this._closeMenu()
    }

    // If we are in home or install dir offer to open folder/bookmark (Basically user hasn't opened a folder yet)
    private _isInstallDirectoryOrHome() {
        return (
            path.dirname(process.execPath) === process.cwd() ||
            process.env[process.platform === "win32" ? "USERPROFILE" : "HOME"] === process.cwd()
        )
    }
    // Show menu based on items given
    private _setItemsFromQuickOpenItems(items: QuickOpenItem[]): void {
        const options = items.map(qitem => {
            const f = qitem.item.trim()
            const file = path.basename(f)
            const folder = path.dirname(f)
            const pinned = this._seenItems.indexOf(f) >= 0

            return {
                icon: getFileIcon(file) as any,
                label: file,
                detail: folder,
                pinned,
                additionalComponent: renderPinnedIcon({ pinned }),
            }
        })

        this._menu.setItems(options)
    }

    private _loadDefaultMenuItems() {
        // Open folder help at top
        this._loadedItems.push(new QuickOpenItem("Open Folder", QuickOpenType.folderHelp))

        // Get bookmarks, if we added remove them all so we don't think we have length
        const bookmarks = configuration.getValue("oni.bookmarks")
        let type = QuickOpenType.bookmark

        // If bookmarks are null show a help message and open config on selection
        // If we are length 0 this is because we haven't added help and we have no bookmarks
        // Once we add help, we now have 1
        if (bookmarks.length === 0) {
            type = QuickOpenType.bookmarkHelp
            bookmarks.push("Opens Configuration to add a bookmark/Add Bookmark")
        }

        // Either way we need to map to quick open item
        bookmarks.forEach((f: string) => {
            this._loadedItems.push(new QuickOpenItem(f, type))
        })

        // reset bookmarks because javascript doesn't respect local garbace collection IF
        // we are help, otherwise... don't... "optimize" >.>... sure
        if (type === QuickOpenType.bookmarkHelp) {
            bookmarks.splice(0, bookmarks.length)
        }
    }
}
