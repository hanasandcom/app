import AppKit
import Combine
import Foundation
import SwiftUI

final class IDETerminalModel: ObservableObject {
    @Published var command = "pwd"
    @Published var output = "$ ready\n"
    @Published var cwd = hanasandSafeIDEWorkspacePath()
    @Published var isRunning = false
    @Published var history: [String] = []
    @Published var historyIndex: Int?
    var activeProcess: Process?
    var activePipe: Pipe?

    func run() {
        run(command)
    }

    func run(_ nextCommand: String) {
        command = nextCommand
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isRunning else { return }
        if history.last != trimmed {
            history.append(trimmed)
        }
        historyIndex = nil
        output += "\n$ \(trimmed)\n"
        isRunning = true

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", trimmed]
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
        process.environment = ProcessInfo.processInfo.environment.merging([
            "TERM": "xterm-256color",
            "HANASAND_DESKTOP": "1",
        ]) { current, _ in current }

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8), !text.isEmpty else { return }
            Task { @MainActor in
                self?.output += text
                if self?.output.count ?? 0 > 80_000 {
                    self?.output = String(self?.output.suffix(60_000) ?? "")
                }
            }
        }
        process.terminationHandler = { [weak self] process in
            pipe.fileHandleForReading.readabilityHandler = nil
            Task { @MainActor in
                if process.terminationStatus != 0 {
                    self?.output += "exit \(process.terminationStatus)\n"
                }
                if self?.output.hasSuffix("\n") == false {
                    self?.output += "\n"
                }
                self?.activeProcess = nil
                self?.activePipe = nil
                self?.isRunning = false
            }
        }

        do {
            activeProcess = process
            activePipe = pipe
            try process.run()
        } catch {
            output += "\(error.localizedDescription)\n"
            activeProcess = nil
            activePipe = nil
            isRunning = false
        }
    }

    func stop() {
        guard let activeProcess, activeProcess.isRunning else { return }
        output += "\n$ stop\n"
        activeProcess.terminate()
    }

    func clear() {
        output = "$ ready\n"
    }

    func previousHistory() {
        guard !history.isEmpty else { return }
        let nextIndex = max((historyIndex ?? history.count) - 1, 0)
        historyIndex = nextIndex
        command = history[nextIndex]
    }

    func nextHistory() {
        guard !history.isEmpty else { return }
        guard let current = historyIndex else { return }
        let nextIndex = current + 1
        if nextIndex >= history.count {
            historyIndex = nil
            command = ""
        } else {
            historyIndex = nextIndex
            command = history[nextIndex]
        }
    }
}
