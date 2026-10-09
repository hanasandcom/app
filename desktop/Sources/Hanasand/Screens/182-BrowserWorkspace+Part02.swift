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

extension BrowserWorkspace {

    func browserToolbar(_ browser: BrowserTabState) -> some View {
        HStack(spacing: 10) {
            BrowserIconButton(systemName: "chevron.left", disabled: !browser.canGoBack) {
                browser.goBack()
            }
            BrowserIconButton(systemName: "chevron.right", disabled: !browser.canGoForward) {
                browser.goForward()
            }
            BrowserIconButton(systemName: browser.isLoading ? "xmark" : "arrow.clockwise") {
                browser.reloadOrStop()
            }
            BrowserAddressField(
                address: Binding(
                    get: { browser.address },
                    set: { browser.address = $0 }
                ),
                isFocused: $addressFocused
            ) {
                openAddress(browser.address, in: browser)
            }
            BrowserIconButton(systemName: "house") {
                browser.load(model.settings.websiteBaseURL)
            }
            BrowserIconButton(systemName: "arrow.up.forward.square") {
                if let url = browser.webView.url {
                    NSWorkspace.shared.open(url)
                }
            }
            BrowserIconButton(systemName: "rectangle.inset.filled.and.person.filled") {
                model.openMiniBrowser(url: browser.address, title: browser.title, minified: false)
            }
            .help("Pop out floating browser")
            BrowserIconButton(systemName: "minus") {
                model.openMiniBrowser(url: browser.address, title: browser.title, minified: true)
            }
            .help("Open minified overlay")
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(theme.commandBar)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.divider)
                .frame(height: 1)
        }
    }

    func openAddress(_ rawValue: String, in browser: BrowserTabState) {
        if let externalURL = BrowserTargetResolver.externalURL(from: rawValue) {
            NSWorkspace.shared.open(externalURL)
            browser.statusText = "Opened externally"
            return
        }
        browser.load(rawValue)
    }

    func consumeBrowserOpenRequest() {
        workspace.configure(settings: model.settings)
        guard let request = model.browserOpenRequest else { return }
        workspace.open(request)
        model.browserActiveAddress = request.url
        model.browserActiveTitle = request.title
        model.browserOpenRequest = nil
    }

    func agentControlPanel(_ browser: BrowserTabState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Label("Agent controls", systemImage: "cursorarrow.motionlines")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(theme.text)
                Text(browser.agentStatus)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
                Spacer()
                BrowserAgentButton(title: "Inspect", icon: "scope") {
                    browser.refreshAgentElements()
                }
                BrowserAgentButton(title: "Click", icon: "cursorarrow.click") {
                    browser.clickAgentSelector()
                }
                BrowserAgentButton(title: "Focus", icon: "selection.pin.in.out") {
                    browser.focusAgentSelector()
                }
                BrowserAgentButton(title: "Type", icon: "keyboard") {
                    browser.typeAgentText()
                }
                BrowserAgentButton(title: "Enter", icon: "return") {
                    browser.pressAgentKey("Enter")
                }
                BrowserAgentButton(title: "Esc", icon: "escape") {
                    browser.pressAgentKey("Escape")
                }
            }

            HStack(spacing: 8) {
                BrowserAgentField(
                    title: "Selector",
                    text: Binding(get: { browser.agentSelector }, set: { browser.agentSelector = $0 }),
                    placeholder: "#login, button[type=submit], .save"
                )
                BrowserAgentField(
                    title: "Text",
                    text: Binding(get: { browser.agentText }, set: { browser.agentText = $0 }),
                    placeholder: "Text to type"
                )
                BrowserAgentField(
                    title: "X",
                    text: Binding(get: { browser.agentX }, set: { browser.agentX = $0 }),
                    placeholder: "120",
                    width: 72
                )
                BrowserAgentField(
                    title: "Y",
                    text: Binding(get: { browser.agentY }, set: { browser.agentY = $0 }),
                    placeholder: "120",
                    width: 72
                )
                BrowserAgentButton(title: "Point", icon: "target") {
                    browser.clickAgentPoint()
                }
                BrowserAgentButton(title: "Up", icon: "arrow.up") {
                    browser.scrollAgentPage(deltaY: -520)
                }
                BrowserAgentButton(title: "Down", icon: "arrow.down") {
                    browser.scrollAgentPage(deltaY: 520)
                }
            }

            if !browser.agentElements.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(browser.agentElements) { element in
                            Button {
                                browser.agentSelector = element.selector
                                browser.agentX = String(Int(element.x))
                                browser.agentY = String(Int(element.y))
                                browser.clickAgentSelector(element.selector)
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(element.label.isEmpty ? element.role : element.label)
                                        .font(.system(size: 11, weight: .bold))
                                        .lineLimit(1)
                                    Text("\(element.role)  \(Int(element.x)),\(Int(element.y))")
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(theme.textTertiary)
                                        .lineLimit(1)
                                }
                                .foregroundStyle(theme.text)
                                .padding(.horizontal, 10)
                                .frame(width: 150, height: 42, alignment: .leading)
                                .background(theme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .help(element.selector)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(theme.backgroundElevated.opacity(0.96))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.divider)
                .frame(height: 1)
        }
    }
}
