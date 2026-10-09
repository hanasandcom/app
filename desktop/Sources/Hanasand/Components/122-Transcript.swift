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

struct Transcript: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 26) {
                    if model.aiMessages.isEmpty {
                        EmptyAIChatCard()
                            .frame(minHeight: 420)
                    } else {
                        ForEach(model.aiMessages) { message in
                            AIMessageBubble(message: message)
                                .id(message.id)
                        }
                        if let edit = model.pendingIDEEdit {
                            AIPendingEditPanel(edit: edit)
                                .id(edit.id)
                        }
                    }
                }
                .padding(.horizontal, 210)
                .padding(.top, 52)
                .padding(.bottom, 190)
            }
            .onChange(of: model.aiMessages.count) {
                scrollToLatest(proxy)
            }
            .onChange(of: model.aiTrace.count) {
                scrollToLatest(proxy)
            }
        }
    }

    func scrollToLatest(_ proxy: ScrollViewProxy) {
        guard let last = model.aiMessages.last else { return }
        withAnimation(.snappy(duration: 0.18)) {
            proxy.scrollTo(last.id, anchor: .bottom)
        }
    }
}
