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

struct WindowFrameRestorer: NSViewRepresentable {
    let storageKey: String

    func makeCoordinator() -> Coordinator {
        Coordinator(storageKey: storageKey)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            context.coordinator.attach(to: window)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let window = nsView.window else { return }
            context.coordinator.attach(to: window)
        }
    }

    final class Coordinator {
        let storageKey: String
        weak var window: NSWindow?
        var observers: [NSObjectProtocol] = []

        init(storageKey: String) {
            self.storageKey = storageKey
        }

        deinit {
            observers.forEach(NotificationCenter.default.removeObserver)
        }

        func attach(to window: NSWindow) {
            guard self.window !== window else { return }
            observers.forEach(NotificationCenter.default.removeObserver)
            observers = []
            self.window = window

            if let saved = UserDefaults.standard.string(forKey: storageKey) {
                let frame = NSRectFromString(saved)
                if !frame.isEmpty, let screenFrame = window.screen?.visibleFrame, screenFrame.intersects(frame) {
                    window.setFrame(frame, display: true)
                }
            }

            let save: (Notification) -> Void = { [weak self, weak window] _ in
                guard let self, let window else { return }
                UserDefaults.standard.set(NSStringFromRect(window.frame), forKey: self.storageKey)
            }

            observers.append(NotificationCenter.default.addObserver(
                forName: NSWindow.didMoveNotification,
                object: window,
                queue: .main,
                using: save
            ))
            observers.append(NotificationCenter.default.addObserver(
                forName: NSWindow.didResizeNotification,
                object: window,
                queue: .main,
                using: save
            ))
        }
    }
}
