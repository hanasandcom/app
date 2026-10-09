import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

final class BrowserWorkspaceModel: ObservableObject {
    @Published var groups: [BrowserTabGroup] = []
    @Published var selectedGroupID = "operations"
    @Published var selectedTabID: UUID?

    var selectedTab: BrowserTabState? {
        guard let group = selectedGroup else { return nil }
        return group.tabs.first { $0.id == selectedTabID } ?? group.tabs.first
    }

    var selectedGroup: BrowserTabGroup? {
        groups.first { $0.id == selectedGroupID } ?? groups.first
    }

    func configure(settings: HanasandDesktopSettings) {
        guard groups.isEmpty else { return }

        let base = settings.websiteBaseURL.normalizedBaseURL
        let operations = BrowserTabGroup(
            id: "operations",
            title: "Operations",
            icon: "gauge.with.dots.needle",
            tabs: [
                BrowserTabState(label: "Dashboard", url: base.appendingPathComponent("dashboard").absoluteString),
                BrowserTabState(label: "System", url: base.appendingPathComponent("system").absoluteString),
            ],
            destinations: [
                BrowserDestination(title: "Dashboard", subtitle: "Overview", icon: "square.grid.2x2", url: base.appendingPathComponent("dashboard").absoluteString),
                BrowserDestination(title: "Logs", subtitle: "Runtime", icon: "doc.text.magnifyingglass", url: base.appendingPathComponent("logs").absoluteString),
                BrowserDestination(title: "Database", subtitle: "Storage", icon: "externaldrive.connected.to.line.below", url: base.appendingPathComponent("db").absoluteString),
                BrowserDestination(title: "VMs", subtitle: "Machines", icon: "display.2", url: base.appendingPathComponent("vms").absoluteString),
            ]
        )
        let communication = BrowserTabGroup(
            id: "communication",
            title: "Communication",
            icon: "bubble.left.and.bubble.right",
            tabs: [
                BrowserTabState(label: "Mail", url: "https://mail.hanasand.com"),
                BrowserTabState(label: "Notes", url: base.appendingPathComponent("notes").absoluteString),
            ],
            destinations: [
                BrowserDestination(title: "Mail", subtitle: "Inbox", icon: "envelope", url: "https://mail.hanasand.com"),
                BrowserDestination(title: "Notes", subtitle: "Shared memory", icon: "note.text", url: base.appendingPathComponent("notes").absoluteString),
                BrowserDestination(title: "Articles", subtitle: "Writing", icon: "text.alignleft", url: base.appendingPathComponent("content/articles").absoluteString),
                BrowserDestination(title: "Thoughts", subtitle: "Ideas", icon: "brain.head.profile", url: base.appendingPathComponent("content/thoughts").absoluteString),
            ]
        )
        let research = BrowserTabGroup(
            id: "research",
            title: "Research",
            icon: "magnifyingglass.circle",
            tabs: [
                BrowserTabState(label: "Hanasand", url: settings.websiteBaseURL),
            ],
            destinations: [
                BrowserDestination(title: "Hanasand", subtitle: "Public site", icon: "house", url: settings.websiteBaseURL),
                BrowserDestination(title: "GitHub", subtitle: "Code", icon: "chevron.left.forwardslash.chevron.right", url: "https://github.com/eirikhanasand"),
                BrowserDestination(title: "DuckDuckGo", subtitle: "Search", icon: "magnifyingglass", url: "https://duckduckgo.com"),
            ]
        )

        groups = [operations, communication, research]
        selectedGroupID = operations.id
        selectedTabID = operations.tabs.first?.id
    }

    func selectGroup(_ id: String) {
        selectedGroupID = id
        selectedTabID = selectedGroup?.tabs.first?.id
    }

    func selectTab(_ id: UUID) {
        selectedTabID = id
    }

    func createGroup() {
        let nextNumber = groups.count + 1
        let tab = BrowserTabState(label: "New tab", url: "https://duckduckgo.com")
        let group = BrowserTabGroup(
            id: UUID().uuidString,
            title: "Group \(nextNumber)",
            icon: "rectangle.stack.badge.plus",
            tabs: [tab],
            destinations: [],
            isCustom: true
        )
        groups.append(group)
        selectedGroupID = group.id
        selectedTabID = tab.id
    }

    func removeSelectedGroup() {
        guard groups.count > 1,
              let removeIndex = groups.firstIndex(where: { $0.id == selectedGroupID }) else { return }
        let removedTabs = groups[removeIndex].tabs
        groups.remove(at: removeIndex)
        let targetIndex = groups.indices.first ?? 0
        groups[targetIndex].tabs.append(contentsOf: removedTabs)
        selectedGroupID = groups[targetIndex].id
        selectedTabID = groups[targetIndex].tabs.first?.id
    }

    func open(_ destination: BrowserDestination) {
        open(label: destination.title, url: destination.url)
    }

    func open(label: String = "New", url: String) {
        guard let groupIndex = groups.firstIndex(where: { $0.id == selectedGroupID }) else { return }
        let tab = BrowserTabState(label: label, url: url)
        groups[groupIndex].tabs.append(tab)
        selectedTabID = tab.id
    }

    func open(_ request: BrowserOpenRequest) {
        if let externalURL = BrowserTargetResolver.externalURL(from: request.url) {
            NSWorkspace.shared.open(externalURL)
            return
        }
        guard let url = URL(string: request.url),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            selectedTab?.statusText = "Only HTTP and HTTPS pages can open in the workspace."
            return
        }
        if let researchIndex = groups.firstIndex(where: { $0.id == "research" }) {
            selectedGroupID = groups[researchIndex].id
        }
        open(label: request.title, url: request.url)
    }

    func close(_ tab: BrowserTabState) {
        guard let groupIndex = groups.firstIndex(where: { $0.id == selectedGroupID }) else { return }
        guard groups[groupIndex].tabs.count > 1 else { return }
        groups[groupIndex].tabs.removeAll { $0.id == tab.id }
        if selectedTabID == tab.id {
            selectedTabID = groups[groupIndex].tabs.last?.id
        }
    }

    func move(_ tab: BrowserTabState, to groupID: String) {
        guard groupID != selectedGroupID,
              let sourceIndex = groups.firstIndex(where: { $0.id == selectedGroupID }),
              let targetIndex = groups.firstIndex(where: { $0.id == groupID }),
              let tabIndex = groups[sourceIndex].tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        let moved = groups[sourceIndex].tabs.remove(at: tabIndex)
        groups[targetIndex].tabs.append(moved)
        selectedGroupID = groupID
        selectedTabID = moved.id
        if groups[sourceIndex].tabs.isEmpty {
            groups[sourceIndex].tabs.append(BrowserTabState(label: "New tab", url: "https://duckduckgo.com"))
        }
    }
}
