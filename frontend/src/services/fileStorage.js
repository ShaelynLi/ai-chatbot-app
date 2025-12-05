/**
 * 文件存储工具
 * 用于将图片保存到本地文件系统，并管理图片文件
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

// 图片存储目录：使用应用私有目录，确保数据安全
const IMAGES_DIR = FileSystem.documentDirectory + 'images/';

/**
 * 保存图片到本地文件系统
 * @param {string} originalUri - 原始图片 URI（可能是临时文件或相册路径）
 * @returns {Promise<string>} 返回保存后的本地 URI
 */
export async function saveImageToLocal(originalUri) {
  try {
    // 确保 images 目录存在（使用 legacy API）
    const dirInfo = await FileSystem.getInfoAsync(IMAGES_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(IMAGES_DIR, { intermediates: true });
    }

    // 生成唯一文件名（使用 SHA256 hash + 时间戳）
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      originalUri + Date.now()
    );
    
    // 从原始 URI 获取文件扩展名
    const ext = originalUri.split('.').pop()?.split('?')[0] || 'jpg';
    const fileName = `${hash.substring(0, 16)}.${ext}`;
    const targetUri = IMAGES_DIR + fileName;

    // 复制文件到目标位置
    await FileSystem.copyAsync({
      from: originalUri,
      to: targetUri,
    });

    return targetUri;
  } catch (error) {
    console.error('saveImageToLocal error:', error);
    throw new Error(`保存图片失败: ${error.message}`);
  }
}

/**
 * 删除本地文件
 * @param {string} uri - 要删除的文件 URI
 * @returns {Promise<void>}
 */
export async function deleteLocalFile(uri) {
  try {
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch (error) {
    console.warn('deleteLocalFile error:', error);
    // 不抛出错误，允许删除失败（文件可能已经不存在）
  }
}

/**
 * 列出本地 images 目录下的所有图片文件
 * @returns {Promise<Array<{ uri: string, size: number }>>}
 */
export async function getAllLocalImages() {
  try {
    const dirInfo = await FileSystem.getInfoAsync(IMAGES_DIR);
    if (!dirInfo.exists) return [];

    const files = await FileSystem.readDirectoryAsync(IMAGES_DIR);
    const result = [];
    for (const name of files) {
      const uri = IMAGES_DIR + name;
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) {
        result.push({ uri, size: info.size || 0 });
      }
    }
    return result;
  } catch (error) {
    console.warn('getAllLocalImages error:', error);
    return [];
  }
}

/**
 * 读取图片文件并转换为 base64
 * @param {string} uri - 本地文件 URI
 * @returns {Promise<string>} base64 字符串（不包含 data:image 前缀）
 */
export async function readImageAsBase64(uri) {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64;
  } catch (error) {
    console.error('readImageAsBase64 error:', error);
    throw new Error(`读取图片失败: ${error.message}`);
  }
}

/**
 * 将 base64 转换为 data URL
 * @param {string} base64 - base64 字符串
 * @param {string} mimeType - MIME 类型，默认 'image/jpeg'
 * @returns {string} data URL
 */
export function base64ToDataUrl(base64, mimeType = 'image/jpeg') {
  return `data:${mimeType};base64,${base64}`;
}

