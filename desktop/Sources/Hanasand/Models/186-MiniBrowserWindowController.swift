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

final class MiniBrowserWindowController {
    static let shared = MiniBrowserWindowController()

    final class WindowRecord {
        let state: MiniBrowserState
        let window: NSWindow
        let delegate: MiniBrowserWindowDelegate
        var cancellables: Set<AnyCancellable> = []

        init(state: MiniBrowserState, window: NSWindow, delegate: MiniBrowserWindowDelegate) {
            self.state = state
            self.window = window
            self.delegate = delegate
        }
    }

    final class MiniBrowserWindowDelegate: NSObject, NSWindowDelegate {
        var onMove: ((NSWindow) -> Void)?
        var onClose: (() -> Void)?

        func windowDidMove(_ notification: Notification) {
            guard let window = notification.object as? NSWindow else { return }
            onMove?(window)
        }

        func windowWillClose(_ notification: Notification) {
            onClose?()
        }
    }

    var windows: [UUID: WindowRecord] = [:]
    var positioningWindowIDs = Set<UUID>()

    func open(url: String, title: String, minified: Bool) {
        let nextState = MiniBrowserState(title: title, url: url, minified: minified)
        let content = MiniBrowserFloatingView(state: nextState)
        let hosting = NSHostingView(rootView: content)
        let nextWindow = NSPanel(
            contentRect: NSRect(origin: .zero, size: size(for: nextState)),
            styleMask: styleMask(for: nextState),
            backing: .buffered,
            defer: false
        )
        nextWindow.contentView = hosting
        nextWindow.backgroundColor = .clear
        nextWindow.isOpaque = false
        nextWindow.hasShadow = true
        nextWindow.level = .floating
        nextWindow.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .fullScreenPrimary]
        nextWindow.isMovableByWindowBackground = true
        nextWindow.titlebarAppearsTransparent = true
        nextWindow.titleVisibility = .hidden
        nextWindow.hidesOnDeactivate = false
        nextWindow.becomesKeyOnlyIfNeeded = true
        nextWindow.minSize = NSSize(width: 92, height: 58)
        nextWindow.title = "Hanasand Mini Browser"

        let delegate = MiniBrowserWindowDelegate()
        let record = WindowRecord(state: nextState, window: nextWindow, delegate: delegate)
        windows[nextState.id] = record
        nextWindow.delegate = delegate

        nextState.snapToCorner = { [weak self, weak nextState] corner in
            guard let self, let nextState, let record = self.windows[nextState.id] else { return }
            nextState.corner = corner
            self.position(window: record.window, state: nextState)
        }
        nextState.cloneWindow = { [weak self, weak nextState] in
            guard let self, let nextState else { return }
            self.open(url: nextState.currentURLString(), title: nextState.tab.title, minified: nextState.isMinified)
        }
        nextState.toggleFullScreen = { [weak self, weak nextState] in
            guard let self, let nextState, let record = self.windows[nextState.id] else { return }
            record.window.toggleFullScreen(nil)
        }

        delegate.onMove = { [weak self, weak nextState] window in
            guard let self, let nextState, !self.positioningWindowIDs.contains(nextState.id) else { return }
            nextState.corner = self.nearestCorner(to: window.frame)
        }
        delegate.onClose = { [weak self, weak nextState] in
            guard let self, let nextState else { return }
            self.windows[nextState.id] = nil
        }

        nextState.$isMinified
            .sink { [weak self, weak nextState] _ in
                guard let self, let nextState, let record = self.windows[nextState.id] else { return }
                self.render(window: record.window, state: nextState)
                self.resizeInPlace(window: record.window, state: nextState)
            }
            .store(in: &record.cancellables)
        nextState.$opacity
            .sink { [weak nextState, weak self] opacity in
                guard let nextState, let window = self?.windows[nextState.id]?.window else { return }
                window.alphaValue = CGFloat(max(0.1, min(1, opacity)))
            }
            .store(in: &record.cancellables)

        position(window: nextWindow, state: nextState)
        nextWindow.orderFrontRegardless()
        if !nextState.isMinified {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func size(for state: MiniBrowserState) -> NSSize {
        state.isMinified ? NSSize(width: 92, height: 58) : NSSize(width: 560, height: 390)
    }

    func styleMask(for state: MiniBrowserState) -> NSWindow.StyleMask {
        var mask: NSWindow.StyleMask = [.titled, .closable, .resizable, .fullSizeContentView]
        if state.isMinified {
            mask.insert(.nonactivatingPanel)
        }
        return mask
    }

    func render(window: NSWindow, state: MiniBrowserState) {
        window.styleMask = styleMask(for: state)
        window.contentView = NSHostingView(rootView: MiniBrowserFloatingView(state: state))
    }

    func resizeInPlace(window: NSWindow, state: MiniBrowserState) {
        let size = size(for: state)
        let frame = window.frame
        let nextOrigin = NSPoint(x: frame.minX, y: frame.maxY - size.height)
        window.setFrame(NSRect(origin: nextOrigin, size: size), display: true, animate: true)
        window.alphaValue = CGFloat(max(0.1, min(1, state.opacity)))
    }

    func position(window: NSWindow, state: MiniBrowserState) {
        let size = size(for: state)
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let margin: CGFloat = 18
        let stackIndex = stackIndex(for: state)
        let stackOffset = CGFloat(stackIndex) * (size.height + 12)
        let origin: NSPoint
        switch state.corner {
        case .topLeft:
            origin = NSPoint(x: screenFrame.minX + margin, y: screenFrame.maxY - size.height - margin - stackOffset)
        case .topRight:
            origin = NSPoint(x: screenFrame.maxX - size.width - margin, y: screenFrame.maxY - size.height - margin - stackOffset)
        case .bottomLeft:
            origin = NSPoint(x: screenFrame.minX + margin, y: screenFrame.minY + margin + stackOffset)
        case .bottomRight:
            origin = NSPoint(x: screenFrame.maxX - size.width - margin, y: screenFrame.minY + margin + stackOffset)
        }
        positioningWindowIDs.insert(state.id)
        window.setFrame(NSRect(origin: origin, size: size), display: true, animate: true)
        window.alphaValue = CGFloat(max(0.1, min(1, state.opacity)))
        Task { @MainActor in
            self.positioningWindowIDs.remove(state.id)
        }
    }

    func stackIndex(for state: MiniBrowserState) -> Int {
        windows.values
            .sorted { $0.state.id.uuidString < $1.state.id.uuidString }
            .filter { $0.state.corner == state.corner }
            .firstIndex { $0.state.id == state.id } ?? 0
    }

    func nearestCorner(to frame: NSRect) -> MiniBrowserCorner {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let center = NSPoint(x: frame.midX, y: frame.midY)
        let isLeft = center.x < screenFrame.midX
        let isBottom = center.y < screenFrame.midY
        switch (isLeft, isBottom) {
        case (true, false): return .topLeft
        case (false, false): return .topRight
        case (true, true): return .bottomLeft
        case (false, true): return .bottomRight
        }
    }
}
