// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IsbnScanner } from './IsbnScanner'

afterEach(cleanup)

describe('IsbnScanner without BarcodeDetector', () => {
  it('says scanning is unavailable and offers the typed ISBN', async () => {
    render(<IsbnScanner env={{}} onIsbn={() => {}} onClose={() => {}} />)
    expect(await screen.findByText(/can't scan barcodes/)).toBeTruthy()
    expect(screen.queryByLabelText('Camera')).toBeNull()
    expect(screen.getByLabelText('ISBN')).toBeTruthy()
  })

  it('hands back a typed ISBN-10 as ISBN-13', async () => {
    const onIsbn = vi.fn()
    render(<IsbnScanner env={{}} onIsbn={onIsbn} onClose={() => {}} />)
    await screen.findByText(/can't scan barcodes/)
    fireEvent.change(screen.getByLabelText('ISBN'), { target: { value: '0-441-01359-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect(onIsbn).toHaveBeenCalledWith('9780441013593')
  })

  it('rejects an invalid ISBN without looking it up', async () => {
    const onIsbn = vi.fn()
    render(<IsbnScanner env={{}} onIsbn={onIsbn} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('ISBN'), { target: { value: '9780441013594' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't a valid ISBN/)
    expect(onIsbn).not.toHaveBeenCalled()
  })

  it('falls back the same way when the browser lacks EAN-13', async () => {
    const BarcodeDetector = Object.assign(function () {}, { getSupportedFormats: async () => ['qr_code'] })
    const env = { BarcodeDetector, navigator: { mediaDevices: { getUserMedia: () => Promise.reject(new Error('unused')) } } }
    render(<IsbnScanner env={env} onIsbn={() => {}} onClose={() => {}} />)
    expect(await screen.findByText(/can't scan barcodes/)).toBeTruthy()
  })
})
