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

struct MiniBrowserFloatingView: View {
    @ObservedObject var state: MiniBrowserState

    var body: some View {
        if state.isMinified {
            Button {
                state.isMinified = false
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .bold))
                    Text(state.tab.label)
                        .font(.system(size: 11, weight: .bold))
                        .lineLimit(1)
                }
                .foregroundStyle(.white)
                .frame(width: 92, height: 58)
                .background(.black.opacity(0.88))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .help("Expand mini browser")
        } else {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Text(state.tab.title)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Spacer()
                    ForEach(MiniBrowserCorner.allCases) { corner in
                        Button(corner.title) {
                            state.snapToCorner?(corner)
                        }
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(state.corner == corner ? .black : .white)
                        .frame(width: 28, height: 24)
                        .background(state.corner == corner ? Color.white : Color.white.opacity(0.14))
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .buttonStyle(.plain)
                        .help("Snap to \(corner.title)")
                    }
                    Slider(value: $state.opacity, in: 0.1...1)
                        .frame(width: 92)
                        .help("Opacity")
                    Text("\(Int(state.opacity * 100))%")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.76))
                        .frame(width: 34, alignment: .trailing)
                    Button {
                        state.toggleFullScreen?()
                    } label: {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 24)
                            .background(Color.white.opacity(0.14))
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .help("Full screen this mini browser")
                    Button {
                        state.cloneWindow?()
                    } label: {
                        Image(systemName: "plus.square.on.square")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 24)
                            .background(Color.white.opacity(0.14))
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .help("Clone mini browser")
                    Button {
                        state.isMinified = true
                    } label: {
                        Image(systemName: "minus")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 24)
                            .background(Color.white.opacity(0.14))
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .help("Minify")
                }
                .padding(.horizontal, 10)
                .frame(height: 38)
                .background(.black.opacity(0.86))

                NativeBrowserView(tab: state.tab)
                    .background(.black)
            }
            .background(.black.opacity(0.82))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(0.22), lineWidth: 1)
            )
        }
    }
}
